// Minimal kafkajs produce + consume test.
// Local (docker cluster): BROKERS=kafka1:19092  (run inside the compose network)
// or from the host:        BROKERS=localhost:9092
//
// Run via a throwaway node container on the kafka network (avoids host npm):
//   docker run --rm --network kafka_default -v "$PWD":/app -w /app node:18-alpine \
//     sh -c "npm i kafkajs --no-save --no-audit --no-fund && BROKERS=kafka1:19092 node kafkajs-test.js"
const { Kafka, logLevel } = require('kafkajs');

const brokers = (process.env.BROKERS || 'kafka1:19092').split(',');
const topic = process.env.TOPIC || 'griddog-test';

const kafka = new Kafka({ clientId: 'local-test', brokers, logLevel: logLevel.NOTHING });

(async () => {
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic,
    messages: [{ value: `hello from kafkajs @ ${new Date().toISOString()}` }],
  });
  console.log('✓ produced 1 message to', topic);
  await producer.disconnect();

  const consumer = kafka.consumer({ groupId: `local-test-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  let n = 0;
  await consumer.run({
    eachMessage: async ({ partition, message }) => {
      console.log(`✓ consumed [p${partition} @ ${message.offset}]:`, message.value.toString());
      if (++n >= 3) { await consumer.disconnect(); process.exit(0); }
    },
  });
  setTimeout(() => { console.log(`done (${n} messages)`); process.exit(0); }, 8000);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
