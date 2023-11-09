
export const countDecimals = (value: number): number => {

  if (Math.floor(value.valueOf()) === value.valueOf()) return 0

  var str = value.toString()
  if (str.indexOf('.') !== -1 && str.indexOf('-') !== -1) {
    return Number(str.split('-')[1] || 0)
  } else if (str.indexOf('.') !== -1) {
    return str.split('.')[1].length || 0
  }
  return Number(str.split('-')[1] || 0)
}