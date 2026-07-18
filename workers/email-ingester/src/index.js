import PostalMime from 'postal-mime';

export default {
  async email(message, env) {
    // Job alerts are small; anything huge is not for us. The ingest API
    // caps bodies at 256KB anyway.
    if (message.rawSize > 1_000_000) {
      message.setReject('Message too large');
      return;
    }

    // message.raw is a single-use stream — buffer it, then parse the MIME.
    const buffer = await new Response(message.raw).arrayBuffer();
    const email = await PostalMime.parse(buffer);

    const text = email.text ?? email.html ?? '';
    const subject = email.subject ?? message.headers.get('subject') ?? '';

    const response = await fetch(env.INGEST_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Ingest-Secret': env.INGEST_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, subject }),
    });

    if (!response.ok) {
      console.error(`Ingest failed (${response.status}): ${await response.text()}`);
    } else {
      console.log('Ingested:', await response.json());
    }
  },
};
