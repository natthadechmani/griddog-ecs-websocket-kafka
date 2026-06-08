import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @HttpCode(202) // accepted: published to Kafka, persisted asynchronously
  create(@Body() body: any) {
    return this.checkout.create(body);
  }
}
