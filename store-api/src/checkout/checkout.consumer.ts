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
  private consumer: Consumer;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  async onModuleInit() {
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

    this.consumer = this.kafka.consumer({ groupId: 'griddog-checkout-writer' });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString());
        const txnId = event.transactionId;
        // eslint-disable-next-line no-console
        console.log(`consuming checkout txnId=${txnId}`);

        await sleep(2000); // mock processing time

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

    // eslint-disable-next-line no-console
    console.log('Kafka consumer running (group griddog-checkout-writer)');
  }

  async onModuleDestroy() {
    if (this.consumer) {
      await this.consumer.disconnect();
    }
  }
}
