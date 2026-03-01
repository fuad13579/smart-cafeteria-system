export const paymentIcons = {
  bkash: require("../../assets/payments/bkash.png"),
  nagad: require("../../assets/payments/nagad.png"),
  bank: require("../../assets/payments/bank.png"),
} as const;

export type PaymentIconKey = keyof typeof paymentIcons;
