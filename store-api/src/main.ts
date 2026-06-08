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
}
bootstrap();
