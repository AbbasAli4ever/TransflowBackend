import { BadRequestException, ValidationPipe, ValidationError } from '@nestjs/common';

function flattenErrors(errors: ValidationError[], parent?: string) {
  const result: { field: string; message: string }[] = [];

  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        result.push({ field, message });
      }
    }
    if (error.children && error.children.length > 0) {
      result.push(...flattenErrors(error.children, field));
    }
  }

  return result;
}

export const buildValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors) => {
      return new BadRequestException({
        message: 'Validation failed',
        errors: flattenErrors(errors),
      });
    },
  });
