import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RealtimeService } from './realtime/realtime.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableShutdownHooks(); // graceful Kafka producer/consumer disconnect
  const port = Number(process.env.PORT) || 4000;
  await app.listen(port, '0.0.0.0');

  // Attach socket.io v4 to the same HTTP server (path /socket.io).
  app.get(RealtimeService).init(app.getHttpServer());

  // eslint-disable-next-line no-console
  console.log(`store-api listening on ${port}`);
  // Surface the resolved Kafka target so each deploy clearly shows what the
  // task is trying to reach (helps diagnose broker reachability vs app bugs).
  // eslint-disable-next-line no-console
  console.log(
    `kafka config: brokers=${process.env.KAFKA_BROKERS || 'localhost:9092'} ` +
      `auth=${(process.env.KAFKA_AUTH || 'none').toLowerCase()} ` +
      `ssl=${process.env.KAFKA_SSL === 'true' || (process.env.KAFKA_AUTH || '').toLowerCase() === 'iam'}`,
  );
}
bootstrap();
