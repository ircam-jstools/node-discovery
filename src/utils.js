export const getTime = () => {
  const hrtime = process.hrtime();
  return hrtime[0] + hrtime[1] * 1e-9;
}
