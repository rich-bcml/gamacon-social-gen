import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

// Register Mont font
const fontPath = join(process.cwd(), 'public/fonts/Mont-HeavyDEMO.otf');
GlobalFonts.registerFromPath(fontPath, 'Mont');

export default async (req, context) => {
  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    console.log('Render function called');
    console.log('User Agent:', req.headers.get('user-agent'));

    const body = await req.json();
    console.log('Request body received, imageDataUrl length:', body.imageDataUrl?.length);

    const { imageDataUrl, templateKey = 'gamacon', zoom = 1, offsetX = 0, offsetY = 0, name = '', position = '', company = '', textOffsetX = 50, textOffsetY = 90 } = body;

    if (!imageDataUrl) {
      return new Response(JSON.stringify({ error: 'Missing imageDataUrl' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // Validate and parse the data URL
    if (!imageDataUrl.startsWith('data:image/')) {
      console.error('Invalid imageDataUrl format:', imageDataUrl.substring(0, 50));
      return new Response(JSON.stringify({
        error: 'Invalid image format. Please ensure you uploaded a valid image file (PNG, JPEG, etc.)'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

    // Validate base64 data
    if (!base64Data || base64Data === imageDataUrl) {
      console.error('Failed to extract base64 data from:', imageDataUrl.substring(0, 100));
      return new Response(JSON.stringify({
        error: 'Invalid image data format. Please try uploading a different image.'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    console.log('Image buffer created, size:', imageBuffer.length);

    // Load the template images (background and foreground layers)
    const templateBgPath = join(process.cwd(), 'public/templates', `${templateKey}-bg.png`);
    const templateFgPath = join(process.cwd(), 'public/templates', `${templateKey}-fg.png`);
    console.log('Template paths:', { templateBgPath, templateFgPath });

    const templateBgBuffer = readFileSync(templateBgPath);
    const templateFgBuffer = readFileSync(templateFgPath);
    console.log('Templates loaded successfully');

    // Define the mask region and foreground offset
    const maskRegion = {
      x: 71,
      y: 55,
      width: 500,
      height: 550,
      radius: 34
    };

    const fgOffset = {
      x: 555,
      y: 261
    };

    // Get user image metadata
    const userImage = sharp(imageBuffer);
    const userImageMeta = await userImage.metadata();

    // Calculate scaled dimensions
    const scaledWidth = Math.round(userImageMeta.width * zoom);
    const scaledHeight = Math.round(userImageMeta.height * zoom);

    // Resize user image with zoom applied using high-quality settings
    const resizedUserImage = await userImage
      .resize(scaledWidth, scaledHeight, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3'
      })
      .toBuffer();

    // Create a canvas the size of the mask region
    const maskCanvas = sharp({
      create: {
        width: maskRegion.width,
        height: maskRegion.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    });

    // Calculate position to place the resized image within the mask region
    // Apply offsets
    let left = Math.round((maskRegion.width - scaledWidth) / 2 + offsetX);
    let top = Math.round((maskRegion.height - scaledHeight) / 2 + offsetY);

    // Determine what part of the user image to use and where to place it
    let extractLeft = 0;
    let extractTop = 0;
    let extractWidth = scaledWidth;
    let extractHeight = scaledHeight;
    let compositeLeft = left;
    let compositeTop = top;

    // If image extends beyond left edge
    if (left < 0) {
      extractLeft = -left;
      extractWidth = scaledWidth + left;
      compositeLeft = 0;
    }

    // If image extends beyond top edge
    if (top < 0) {
      extractTop = -top;
      extractHeight = scaledHeight + top;
      compositeTop = 0;
    }

    // If image extends beyond right edge
    if (left + scaledWidth > maskRegion.width) {
      extractWidth = Math.min(extractWidth, maskRegion.width - compositeLeft);
    }

    // If image extends beyond bottom edge
    if (top + scaledHeight > maskRegion.height) {
      extractHeight = Math.min(extractHeight, maskRegion.height - compositeTop);
    }

    // Extract the visible portion of the user image
    let imageToComposite = resizedUserImage;
    if (extractLeft > 0 || extractTop > 0 || extractWidth < scaledWidth || extractHeight < scaledHeight) {
      imageToComposite = await sharp(resizedUserImage)
        .extract({
          left: Math.round(extractLeft),
          top: Math.round(extractTop),
          width: Math.round(Math.max(1, extractWidth)),
          height: Math.round(Math.max(1, extractHeight))
        })
        .toBuffer();
    }

    // Composite the user image onto the mask canvas
    const maskedImage = await maskCanvas
      .composite([{
        input: imageToComposite,
        left: compositeLeft,
        top: compositeTop
      }])
      .png()
      .toBuffer();


    // Create rounded rectangle mask using canvas (to avoid SVG issues in Netlify)
    const canvas = createCanvas(maskRegion.width, maskRegion.height);
    const ctx = canvas.getContext('2d');

    // Draw rounded rectangle
    const radius = maskRegion.radius;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(maskRegion.width - radius, 0);
    ctx.quadraticCurveTo(maskRegion.width, 0, maskRegion.width, radius);
    ctx.lineTo(maskRegion.width, maskRegion.height - radius);
    ctx.quadraticCurveTo(maskRegion.width, maskRegion.height, maskRegion.width - radius, maskRegion.height);
    ctx.lineTo(radius, maskRegion.height);
    ctx.quadraticCurveTo(0, maskRegion.height, 0, maskRegion.height - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();

    // Convert canvas to PNG buffer
    const roundedMaskPng = canvas.toBuffer('image/png');

    // Apply rounded corners mask
    const maskedWithRoundedCorners = await sharp(maskedImage)
      .composite([{
        input: roundedMaskPng,
        blend: 'dest-in'
      }])
      .toBuffer();

    // Get background dimensions
    const bgMeta = await sharp(templateBgBuffer).metadata();

    // Extract the portion of foreground that will be visible
    const fgMeta = await sharp(templateFgBuffer).metadata();

    // Calculate how much of the foreground to extract
    const fgExtractWidth = Math.min(fgMeta.width, bgMeta.width - fgOffset.x);
    const fgExtractHeight = Math.min(fgMeta.height, bgMeta.height - fgOffset.y);

    // Only composite if there's a valid region
    let fgToComposite = templateFgBuffer;
    if (fgExtractWidth > 0 && fgExtractHeight > 0 && fgExtractWidth < fgMeta.width) {
      fgToComposite = await sharp(templateFgBuffer)
        .extract({
          left: 0,
          top: 0,
          width: fgExtractWidth,
          height: fgExtractHeight
        })
        .toBuffer();
    }

    // Composite layers: background -> masked photo -> foreground
    let finalImageBuffer = await sharp(templateBgBuffer)
      .composite([
        {
          input: maskedWithRoundedCorners,
          left: maskRegion.x,
          top: maskRegion.y
        },
        {
          input: fgToComposite,
          left: fgOffset.x,
          top: fgOffset.y
        }
      ])
      .png({
        quality: 100,
        compressionLevel: 6
      })
      .toBuffer();

    // Add text if provided
    if (name || position || company) {
      const finalMeta = await sharp(finalImageBuffer).metadata();
      const textCanvas = createCanvas(finalMeta.width, finalMeta.height);
      const textCtx = textCanvas.getContext('2d');

      // Measure text to determine background size
      const padding = 20;
      const lineHeight = 40;
      let maxWidth = 0;
      let lines = [];

      if (name) {
        textCtx.font = '900 32px Mont';
        const metrics = textCtx.measureText(name);
        lines.push({ text: name, font: '900 32px Mont', width: metrics.width });
        maxWidth = Math.max(maxWidth, metrics.width);
      }

      if (position) {
        textCtx.font = '900 24px Mont';
        const metrics = textCtx.measureText(position);
        lines.push({ text: position, font: '900 24px Mont', width: metrics.width });
        maxWidth = Math.max(maxWidth, metrics.width);
      }

      if (company) {
        textCtx.font = '900 24px Mont';
        const metrics = textCtx.measureText(company);
        lines.push({ text: company, font: '900 24px Mont', width: metrics.width });
        maxWidth = Math.max(maxWidth, metrics.width);
      }

      // Calculate background dimensions
      const bgWidth = maxWidth + (padding * 2);
      const bgHeight = (lines.length * lineHeight) + (padding * 2);
      const bgX = textOffsetX;
      const bgY = finalMeta.height - textOffsetY - bgHeight;

      // Draw black rounded rectangle background with green outline
      const radius = 12;
      textCtx.beginPath();
      textCtx.moveTo(bgX + radius, bgY);
      textCtx.lineTo(bgX + bgWidth - radius, bgY);
      textCtx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
      textCtx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
      textCtx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
      textCtx.lineTo(bgX + radius, bgY + bgHeight);
      textCtx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
      textCtx.lineTo(bgX, bgY + radius);
      textCtx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
      textCtx.closePath();

      // Fill background
      textCtx.fillStyle = '#000000';
      textCtx.fill();

      // Draw green outline
      textCtx.strokeStyle = '#9adb38';
      textCtx.lineWidth = 3;
      textCtx.stroke();

      // Draw text on top of background (vertically centered in each line)
      textCtx.fillStyle = '#9adb38';
      textCtx.textAlign = 'left';
      textCtx.textBaseline = 'middle';

      let yPosition = bgY + padding + (lineHeight / 2);
      for (const line of lines) {
        textCtx.font = line.font;
        textCtx.fillText(line.text, bgX + padding, yPosition);
        yPosition += lineHeight;
      }

      // Convert text canvas to PNG buffer
      const textLayerPng = textCanvas.toBuffer('image/png');

      // Composite text on top of final image
      finalImageBuffer = await sharp(finalImageBuffer)
        .composite([{
          input: textLayerPng,
          left: 0,
          top: 0
        }])
        .png({
          quality: 100,
          compressionLevel: 6
        })
        .toBuffer();
    }

    // Check size and resize if needed to stay under Netlify's 6MB limit
    // Base64 encoding adds ~33% overhead, so target max 4MB buffer = ~5.3MB base64
    const maxBufferSize = 4 * 1024 * 1024; // 4MB
    if (finalImageBuffer.length > maxBufferSize) {
      console.log(`Image too large (${finalImageBuffer.length} bytes), resizing to fit under 6MB limit`);
      // Resize to fit under limit while maintaining aspect ratio
      const metadata = await sharp(finalImageBuffer).metadata();
      const scaleFactor = Math.sqrt(maxBufferSize / finalImageBuffer.length);
      const newWidth = Math.floor(metadata.width * scaleFactor);

      finalImageBuffer = await sharp(finalImageBuffer)
        .resize(newWidth, null, { withoutEnlargement: true })
        .png({ quality: 100, compressionLevel: 9 })
        .toBuffer();

      console.log(`Resized to ${newWidth}px width, new size: ${finalImageBuffer.length} bytes`);
    }

    // Convert to base64
    const finalBase64 = finalImageBuffer.toString('base64');
    const finalDataUrl = `data:image/png;base64,${finalBase64}`;
    console.log(`Final base64 length: ${finalBase64.length} bytes`);

    return new Response(JSON.stringify({
      success: true,
      imageDataUrl: finalDataUrl
    }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Error processing image:', error);
    console.error('Error stack:', error.stack);
    return new Response(JSON.stringify({
      error: 'Failed to process image',
      details: error.message,
      stack: error.stack,
      location: error.fileName || 'unknown'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
};
