// MongoClient singleton: kết nối 1 lần khi khởi động, dùng chung cho toàn app
const { MongoClient } = require('mongodb');

let client = null;

async function connect() {
  if (client) return client;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Thiếu MONGODB_URI trong file .env');
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    appName: 'mflix-demo',
  });
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  return client;
}

function getClient() {
  if (!client) throw new Error('MongoDB chưa kết nối');
  return client;
}

// Database chính (sample_mflix) và database phụ (movie_demo)
const mflix = () => getClient().db(process.env.MONGODB_DB || 'sample_mflix');
const demo = () => getClient().db('movie_demo');

async function close() {
  if (client) {
    await client.close();
    client = null;
  }
}

module.exports = { connect, getClient, mflix, demo, close };
