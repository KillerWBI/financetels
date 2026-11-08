import { addMonths } from '../../shared/core';

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
export const pln = (n: number): string => money.format(n);

const plain = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const num = (n: number): string => plain.format(n);

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const monthName = (m: string): string => MONTHS[Number(m.slice(5, 7)) - 1];
export const monthTitle = (m: string): string => `${monthName(m)} ${m.slice(0, 4)}`;
export const monthShort = (m: string): string => `${monthName(m).slice(0, 3)} ${m.slice(2, 4)}`;
export const dayMonth = (d: string): string => `${Number(d.slice(8, 10))} ${MONTHS_GEN[Number(d.slice(5, 7)) - 1]}`;

export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const currentMonth = (): string => today().slice(0, 7);

export { addMonths };

export const tone = (n: number): string => (n < 0 ? 'neg' : 'pos');
