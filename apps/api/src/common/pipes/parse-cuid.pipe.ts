import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const CUID_PATTERN = /^[a-z0-9]{20,32}$/i;

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!CUID_PATTERN.test(value)) {
      throw new BadRequestException('Invalid id format');
    }
    return value;
  }
}
