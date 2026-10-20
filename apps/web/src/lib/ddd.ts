/** DDD → UF dos telefones brasileiros. */
export const DDD_UF: Record<string, string> = {}
for (const [uf, ddds] of Object.entries({
  SP: [11, 12, 13, 14, 15, 16, 17, 18, 19], RJ: [21, 22, 24], ES: [27, 28], MG: [31, 32, 33, 34, 35, 37, 38], PR: [41, 42, 43, 44, 45, 46],
  SC: [47, 48, 49], RS: [51, 53, 54, 55], DF: [61], GO: [62, 64], TO: [63], MT: [65, 66], MS: [67], AC: [68], RO: [69],
  BA: [71, 73, 74, 75, 77], SE: [79], PE: [81, 87], AL: [82], PB: [83], RN: [84], CE: [85, 88], PI: [86, 89], PA: [91, 93, 94],
  AM: [92, 97], RR: [95], AP: [96], MA: [98, 99],
})) for (const d of ddds) DDD_UF[String(d)] = uf
