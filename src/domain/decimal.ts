import Decimal from "decimal.js";

// Exact decimal arithmetic for money and quantities. 40 significant digits leave ample room
// for NUMERIC(28, 10) values and for divisions such as splits or average cost.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
