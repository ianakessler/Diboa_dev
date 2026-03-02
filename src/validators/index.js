import { cpf as cpfValidator } from 'cpf-cnpj-validator';
import { BadRequestError } from '../errors/AppError.js';

/**
 * Sanitizes and validates a CPF string.
 * @param {string} raw - Raw CPF string (with or without formatting)
 * @returns {string} Digits-only CPF
 * @throws {BadRequestError}
 */
export function validateCpf(raw) {
  if (typeof raw !== 'string') throw new BadRequestError('CPF inválido');
  const digits = raw.replace(/\D/g, '');
  if (!cpfValidator.isValid(digits)) throw new BadRequestError('CPF inválido');
  return digits;
}

/**
 * Validates a positive integer for points.
 * @param {unknown} value
 * @returns {number}
 * @throws {BadRequestError}
 */
export function validatePontos(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new BadRequestError('O campo pontos deve ser um inteiro positivo');
  }
  return num;
}
