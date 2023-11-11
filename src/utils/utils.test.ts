import { expect, test } from 'vitest'
import { countDecimals } from './utils'

test('returns 0 for intergers', () => {
  expect(countDecimals(2322)).toEqual(0)
  expect(countDecimals(-2322)).toEqual(0)
  expect(countDecimals(-0)).toEqual(0)
})

test('correctly counts decimal placements', () => {
  expect(countDecimals(1234.1234)).toEqual(4)
  expect(countDecimals(1.1004667)).toEqual(7)
  expect(countDecimals(1.1)).toEqual(1)
})

test('correctly counts decimal placements for negative numbers', () => {
  expect(countDecimals(-2.2)).toEqual(1)
  expect(countDecimals(-0.1)).toEqual(1)
  expect(countDecimals(-120.867)).toEqual(3)
})
