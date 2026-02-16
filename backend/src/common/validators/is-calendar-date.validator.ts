import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export function IsCalendarDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCalendarDate',
      target: (object as any).constructor,
      propertyName,
      options,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
          const [y, m, d] = value.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
        },
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a valid calendar date in YYYY-MM-DD format`,
      },
    });
  };
}
