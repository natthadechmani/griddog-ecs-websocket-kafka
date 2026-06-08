import { KafkaConfig } from 'kafkajs';

export const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'griddog-checkouts';

/**
 * Build a kafkajs config from env so the same image works in both environments:
 *   - local docker cluster: KAFKA_AUTH=none (plaintext)
 *   - Amazon MSK:           KAFKA_AUTH=iam  (TLS + SASL/OAUTHBEARER via the IAM signer)
 */
export function buildKafkaConfig(): KafkaConfig {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  const auth = (process.env.KAFKA_AUTH || 'none').toLowerCase();

  if (auth === 'iam') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { generateAuthToken } = require('aws-msk-iam-sasl-signer-js');
    const region = process.env.AWS_REGION || 'ap-southeast-1';
    return {
      clientId: 'store-api',
      brokers,
      ssl: true,
      sasl: {
        mechanism: 'oauthbearer',
        oauthBearerProvider: async () => {
          const { token } = await generateAuthToken({ region });
          return { value: token };
        },
      } as any,
    };
  }

  return {
    clientId: 'store-api',
    brokers,
    ssl: process.env.KAFKA_SSL === 'true',
  };
}
