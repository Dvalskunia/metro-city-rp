const sharp = require('sharp');
const path = require('path');

async function removeBackground() {
    try {
        const inputPath = path.join(__dirname, '..', 'logo.png');
        const outputPath = path.join(__dirname, 'images', 'logo-transparent.png');
        
        // Use sharp's built-in negate and threshold to isolate the logo
        // First create a mask based on brightness
        const metadata = await sharp(inputPath).metadata();
        const { width, height } = metadata;
        
        const { data } = await sharp(inputPath)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        const pixels = Buffer.from(data);
        
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            
            // Calculate perceived brightness (0-255)
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
            
            // Check if pixel is close to pure black
            const isBlack = r < 40 && g < 40 && b < 40;
            
            // Check if it's dark with low color saturation
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const isLowSat = (maxC - minC) < 30;
            const isDark = brightness < 70;
            
            if (isBlack || (isDark && isLowSat)) {
                // Make fully transparent
                pixels[i + 3] = 0;
            } else if (brightness < 90 && isLowSat) {
                // Semi-transparent edge
                const alpha = Math.floor(((brightness - 40) / 50) * 255);
                pixels[i + 3] = Math.max(0, Math.min(255, alpha));
            }
        }
        
        await sharp(pixels, {
            raw: { width, height, channels: 4 }
        })
        .png()
        .toFile(outputPath);
        
        console.log('Logo with transparent background saved!');
    } catch (error) {
        console.error('Error:', error);
    }
}

removeBackground();