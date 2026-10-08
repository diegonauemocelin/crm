import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator'

export class LoginDto {
  @ApiProperty() @IsEmail({}, { message: 'Informe um e-mail válido.' }) @MaxLength(200) email!: string
  @ApiProperty() @IsString() @Length(1, 128) password!: string
}

export class MfaCodeDto {
  @ApiProperty({ description: 'Código de 6 dígitos do autenticador ou código de recuperação' })
  @IsString()
  @Length(6, 12)
  code!: string
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail({}, { message: 'Informe um e-mail válido.' }) @MaxLength(200) email!: string
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 200) token!: string
  @ApiProperty() @IsString() @Length(1, 128) password!: string
}

export class OptionalPasswordDto {
  @ApiPropertyOptional({ description: 'Obrigatória quando o 2FA já está ativo (reconfigurar).' }) @IsOptional() @IsString() @Length(1, 128) password?: string
}

export class PasswordDto {
  @ApiProperty() @IsString() @Length(1, 128) password!: string
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 128) currentPassword!: string
  @ApiProperty() @IsString() @Length(1, 128) newPassword!: string
}
