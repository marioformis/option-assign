/* Number formatting shared by the page and the chart. */

export const dollars = (value) => (value < 0 ? "-$" : "$") + Math.abs(value).toFixed(2);

export const percent = (fraction) => (fraction * 100).toFixed(1) + "%";

export const wholeDollars = (value) => "$" + Math.round(value).toLocaleString("en-US");
