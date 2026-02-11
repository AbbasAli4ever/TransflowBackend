import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  LoggerService,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { getContext } from '../request-context';

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const context = getContext();
    const requestId = context?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: { field: string; message: string }[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse() as
        | string
        | { message?: string | string[]; error?: string; errors?: any };

      if (typeof responseBody === 'string') {
        message = responseBody;
      } else {
        if (responseBody?.errors) {
          message = Array.isArray(responseBody?.message)
            ? responseBody.message.join(', ')
            : (responseBody?.message as string ?? 'Validation failed');
          errors = responseBody.errors;
        } else if (Array.isArray(responseBody?.message)) {
          message = 'Validation failed';
          errors = responseBody.message.map((item) => ({
            field: typeof item === 'string' ? item : 'unknown',
            message: typeof item === 'string' ? item : 'Invalid value',
          }));
        } else {
          message = responseBody?.message ?? exception.message;
        }
      }
    }

    const responseBody = {
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };

    if (status >= 500) {
      this.logger.error('request_error', {
        ...responseBody,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn('request_warning', responseBody);
    }

    response.status(status).json(responseBody);
  }
}
