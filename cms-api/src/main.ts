import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT) || 4001;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`cms-api listening on ${port}`);
}
bootstrap();
