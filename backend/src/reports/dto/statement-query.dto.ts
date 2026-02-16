import { IsNotEmpty, registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.validator';

function IsNotBefore(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotBefore',
      target: (object as any).constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedProp] = args.constraints;
          const relatedValue = (args.object as any)[relatedProp];
          if (typeof value !== 'string' || typeof relatedValue !== 'string') return true;
          return value >= relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be on or after ${args.constraints[0]}`;
        },
      },
    });
  };
}

export class StatementQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Start date inclusive (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsCalendarDate()
  dateFrom!: string;

  @ApiProperty({ example: '2026-02-20', description: 'End date inclusive (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsCalendarDate()
  @IsNotBefore('dateFrom', { message: 'dateTo must be on or after dateFrom' })
  dateTo!: string;
}
