import { IsEmail, IsNotEmpty, IsString, Length, IsStrongPassword } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Acme Trading Co.', description: 'Name of the business / tenant' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  @Transform(({ value }) => value?.trim())
  tenantName!: string;

  @ApiProperty({ example: 'Zaeem Hassan', description: 'Owner full name' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  @Transform(({ value }) => value?.trim())
  fullName!: string;

  @ApiProperty({ example: 'zaeem@acme.com', description: 'Owner email address' })
  @IsEmail()
  @Transform(({ value }) => value?.trim().toLowerCase())
  email!: string;

  @ApiProperty({ example: 'MyPass123', description: 'Min 8 chars, 1 uppercase, 1 lowercase, 1 number' })
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 0,
  })
  password!: string;
}
