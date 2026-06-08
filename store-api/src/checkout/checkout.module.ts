import { Module } from '@nestjs/common';
import { CheckoutConsumer } from './checkout.consumer';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  controllers: [CheckoutController],
  providers: [CheckoutService, CheckoutConsumer],
})
export class CheckoutModule {}
