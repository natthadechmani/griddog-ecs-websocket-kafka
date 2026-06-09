import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { Db } from 'mongodb';
import { KAFKA } from '../kafka/kafka.module';
import { KAFKA_TOPIC } from '../kafka/kafka.config';
import { MONGO_DB } from '../mongo/mongo.module';
import { RealtimeService } from '../realtime/realtime.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class CheckoutConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer?: Consumer;
  private stopped = false;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    // Kick off Kafka + index setup in the background so the HTTP server can
    // start listening immediately. If brokers (or Mongo) are unreachable the
    // API and /health still come up, and we retry connecting until success.
    void this.initInBackground();
  }

  private async initInBackground() {
    for (let attempt = 1; !this.stopped; attempt++) {
      try {
        await this.connectAndRun();
        // eslint-disable-next-line no-console
        console.log('Kafka consumer running (group griddog-checkout-writer)');
        return;
      } catch (e) {
        // Clean up a partially-connected consumer before retrying.
        if (this.consumer) {
          try {
            await this.consumer.disconnect();
          } catch {
            /* ignore */
          }
          this.consumer = undefined;
        }
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        // eslint-disable-next-line no-console
        console.error(
          `Kafka consumer init failed (attempt ${attempt}): ${
            (e as Error).message
          }; retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  private async connectAndRun() {
    // Idempotency guard: one order doc per transactionId (sparse so legacy docs
    // without the field don't collide on null).
    await this.db
      .collection('checkouts')
      .createIndex({ transactionId: 1 }, { unique: true, sparse: true });

    // Ensure the topic exists (idempotent). Avoids a manual IAM topic-create on
    // MSK. RF/partitions are env-tunable (MSK with 2 brokers needs RF=2).
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const created = await admin.createTopics({
        waitForLeaders: true,
        topics: [
          {
            topic: KAFKA_TOPIC,
            numPartitions: Number(process.env.KAFKA_TOPIC_PARTITIONS || 3),
            replicationFactor: Number(process.env.KAFKA_TOPIC_RF || 3),
          },
        ],
      });
      // eslint-disable-next-line no-console
      console.log(`topic ${KAFKA_TOPIC} ${created ? 'created' : 'already exists'}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`createTopics note: ${(e as Error).message}`);
    }
    await admin.disconnect();

    const consumer = this.kafka.consumer({ groupId: 'griddog-checkout-writer' });
    this.consumer = consumer;
    await consumer.connect();
    // fromBeginning: true so a freshly-created consumer group still picks up
    // messages produced during its startup/connect window (otherwise it starts
    // at the latest offset and silently skips them → client stuck on
    // "Processing…"). The Mongo upsert below is idempotent, so re-reading old
    // messages is harmless.
    await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString());
        const txnId = event.transactionId;
        // eslint-disable-next-line no-console
        console.log(`consuming checkout txnId=${txnId}`);

        await sleep(500); // mock processing time

        await this.db.collection('checkouts').updateOne(
          { transactionId: txnId },
          {
            $setOnInsert: {
              transactionId: txnId,
              items: event.items,
              total: event.total,
              customer: event.customer,
              createdAt: new Date(event.createdAt || Date.now()),
            },
          },
          { upsert: true },
        );
        // eslint-disable-next-line no-console
        console.log(`persisted checkout txnId=${txnId}`);

        this.realtime.emitDone(txnId, {
          transactionId: txnId,
          total: event.total,
          status: 'done',
        });
      },
    });
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.consumer) {
      await this.consumer.disconnect();
    }
  }
}
