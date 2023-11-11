export const countDecimals = (value: number): number => {
  if (Number.isInteger(value)) return 0

  const numberAsString = value.toString()
  const [_, decimals] = numberAsString.split('.')

  return decimals ? decimals.length : 0
}
