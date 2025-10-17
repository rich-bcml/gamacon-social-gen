export default async (req, context) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'image/png',
    'Content-Disposition': 'attachment; filename="gamacon-social.png"',
    'Cache-Control': 'no-cache'
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
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { imageDataUrl } = body;

    if (!imageDataUrl) {
      return new Response(JSON.stringify({ error: 'Missing imageDataUrl' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse the data URL and convert to buffer
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Return the image as binary data
    return new Response(imageBuffer, {
      status: 200,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Error serving image:', error);
    return new Response(JSON.stringify({
      error: 'Failed to serve image',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
