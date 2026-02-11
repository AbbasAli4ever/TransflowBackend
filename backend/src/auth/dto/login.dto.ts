import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'zaeem@acme.com' })
  @IsEmail()
  @Transform(({ value }) => value?.trim().toLowerCase())
  email!: string;

  @ApiProperty({ example: 'MyPass123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
