export default {
  async email(message) {
    const text = await message.text();
    const subject = message.headers.get('subject') || '';

    try {
      const response = await fetch(
        'https://bpo-lyart.vercel.app/api/ingest/email',
        {
          method: 'POST',
          headers: {
            'X-Ingest-Secret': 'sk_ingest_email_7f2d8c9e1a4b6f3h5j2k8m1n9p4q7r5s',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text, subject }),
        }
      );

      if (!response.ok) {
        console.error(
          `Ingest failed (${response.status}):`,
          await response.text()
        );
      } else {
        const result = await response.json();
        console.log('Ingested:', result);
      }
    } catch (error) {
      console.error('Email ingestion error:', error.message);
    }
  },
};
