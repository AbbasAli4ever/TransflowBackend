import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import { format, transports } from 'winston';

export function createLoggerOptions(formatType: string) {
  const isJson = formatType === 'json';

  return {
    transports: [
      new transports.Console({
        format: isJson
          ? format.combine(format.timestamp(), format.json())
          : format.combine(
              format.timestamp(),
              nestWinstonModuleUtilities.format.nestLike('FinanceSystem', {
                prettyPrint: true,
              }),
            ),
      }),
    ],
  };
}
