const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _client;
}

async function uploadToSupabase(buffer, filePath) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'line-images';
  const client = getClient();

  const { error } = await client.storage
    .from(bucket)
    .upload(filePath, buffer, { contentType: 'image/png', upsert: true });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: { publicUrl } } = client.storage.from(bucket).getPublicUrl(filePath);
  return publicUrl;
}

module.exports = { uploadToSupabase };
