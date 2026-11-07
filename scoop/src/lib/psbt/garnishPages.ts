/** Current page first, then the pages after it, then any pages before it. */
export function garnishPageOrder(current: number, pageCount: number): number[] {
  const order: number[] = [];
  for (let i = Math.max(0, current); i < pageCount; i++) order.push(i);
  for (let i = 0; i < current; i++) order.push(i);
  return order;
}
