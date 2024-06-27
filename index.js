const express = require('express');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const cheerio = require('cheerio');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = 3000;

const savelink = {
    finalUrl: null,
    async saveAndTransfer(finalUrl) {
        try {
            this.finalUrl = finalUrl;
            console.log('Saved final URL:', this.finalUrl);

            const transferResponse = await axios.get(`https://fgdpscc.ps.fhgdps.com/jonell.php?url=${this.finalUrl}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.1',
                },
            });
            console.log('Transfer response:', transferResponse.data);

            
            this.clear();

            return transferResponse.data;
        } catch (error) {
            console.error('Error:', error);
            throw error;
        }
    },
    clear() {
        this.finalUrl = null;
        console.log('Cleared final URL.');
    },
};

async function downloadAndUploadMusic(youtubeUrl) {
    try {
        const info = await ytdl.getInfo(youtubeUrl);
        const title = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_');
        const inputFilePath = path.resolve(__dirname, `${title}.mp3`);
        const outputFilePath = path.resolve(__dirname, `${title}.m4a`);

        const downloadStream = ytdl(youtubeUrl, { filter: 'audioonly' });
        const fileWriteStream = fs.createWriteStream(inputFilePath);
        downloadStream.pipe(fileWriteStream);

        await new Promise((resolve, reject) => {
            downloadStream.on('end', resolve);
            downloadStream.on('error', reject);
        });

        console.log(`Downloaded ${inputFilePath}`);

        
        await convertMp3ToM4a(inputFilePath, outputFilePath);
        console.log(`Converted to ${outputFilePath}`);

        const instance = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
            baseURL: 'https://www.cjoint.com/',
        });
        const uploadUrl = await getUploadUrl(instance);
        const uploadResponse = await uploadFile(outputFilePath, uploadUrl, instance);
        const cjointLink = await getCjointLink(uploadResponse);
        console.log('cjoint.com link:', cjointLink);

        const finalUrl = await getFinalUrl(cjointLink);
        console.log('Final URL:', finalUrl);

        const transferResponse = await savelink.saveAndTransfer(finalUrl);

        
        fs.unlink(inputFilePath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
            } else {
                console.log('MP3 file deleted successfully');
            }
        });

        fs.unlink(outputFilePath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
            } else {
                console.log('M4A file deleted successfully');
            }
        });

        return transferResponse;

    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

function convertMp3ToM4a(input, output) {
    return new Promise((resolve, reject) => {
        ffmpeg(input)
            .toFormat('mp3')
            .on('end', resolve)
            .on('error', reject)
            .save(output);
    });
}

async function getUploadUrl(instance) {
    const response = await instance.get('/');
    const $ = cheerio.load(response.data);
    return $('#form-upload').attr('action');
}

async function uploadFile(filePath, uploadUrl, instance) {
    const formData = new FormData();
    formData.append('USERFILE', fs.createReadStream(filePath));

    const response = await instance.post(uploadUrl, formData, {
        headers: formData.getHeaders(),
    });
    return response.data;
}

async function getCjointLink(uploadResponse) {
    const $ = cheerio.load(uploadResponse);
    const link = $('.share_url a').attr('href');
    return link;
}

async function getFinalUrl(cjointLink) {
    const instance = axios.create({
        headers: {
            'User-Agent': 'Mozilla/5.0',
        },
        baseURL: cjointLink,
    });

    try {
        const htmlResponse = await instance.get('/');
        const html$ = cheerio.load(htmlResponse.data);
        const shareUrl = html$('.share_url a').attr('href');
        const finalUrl = `https://www.cjoint.com${shareUrl.split('"')[0]}`;
        return finalUrl;
    } catch (error) {
        console.error('Error getting final URL:', error);
        throw error;
    }
}

app.get('/api/uploadsong', async (req, res) => {
    const youtubeUrl = req.query.url;
    if (!youtubeUrl) {
        return res.status(400).send('YouTube URL is required.');
    }

    try {
        const transferResponse = await downloadAndUploadMusic(youtubeUrl);
        res.json({ message: 'Song uploaded and processed successfully.', transferResponse });
    } catch (error) {
        res.status(500).send('An error occurred while processing the song.');
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
