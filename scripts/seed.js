/* eslint-disable no-console */
// Seeds the `products` collection with sample Datadog merch.
// Usage (host): npm install && npm run seed
//   Optionally set MONGO_URI (default mongodb://localhost:27017/griddog).
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/griddog';

// Prices in cents.
const products = [
  { name: 'Bits the Dog Plushie', description: 'The one and only Bits, in huggable form.', price: 2499, imageUrl: 'https://via.placeholder.com/300x200?text=Bits+Plushie', stock: 50 },
  { name: 'Datadog Hoodie', description: 'Cozy purple hoodie with the Datadog logo.', price: 4999, imageUrl: 'https://via.placeholder.com/300x200?text=Hoodie', stock: 30 },
  { name: 'Sticker Pack', description: 'Assorted Datadog + Bits stickers (10 pack).', price: 599, imageUrl: 'https://via.placeholder.com/300x200?text=Stickers', stock: 200 },
  { name: 'Coffee Mug', description: 'Observe your morning coffee. 12oz ceramic.', price: 1499, imageUrl: 'https://via.placeholder.com/300x200?text=Mug', stock: 80 },
  { name: 'Dashboard Socks', description: 'Crew socks with a tiny dashboard pattern.', price: 1299, imageUrl: 'https://via.placeholder.com/300x200?text=Socks', stock: 120 },
  { name: 'Logo Cap', description: 'Adjustable cap with embroidered logo.', price: 1999, imageUrl: 'https://via.placeholder.com/300x200?text=Cap', stock: 60 },
];

(async () => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    // Atlas SRV strings often have no db in the path, so honor MONGO_DB_NAME.
    const db = process.env.MONGO_DB_NAME ? client.db(process.env.MONGO_DB_NAME) : client.db();
    const col = db.collection('products');
    await col.deleteMany({});
    const res = await col.insertMany(products);
    console.log(`Seeded ${res.insertedCount} products into ${db.databaseName}.products`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
