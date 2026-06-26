const sharp = require('sharp');
const path = require('path');

async function createFavicon() {
    const input = path.join(__dirname, '..', 'logo.png');
    const output = path.join(__dirname, 'public', 'favicon.png');
    
    await sharp(input)
        .resize(64, 64)
        .png()
        .toFile(output);
    
    console.log('Favicon created!');
}

createFavicon();