/**
 * Extras added while the booking is being taken.
 *
 * The rate plan's own extras already come down with the price — breakfast
 * on a company plan is quoted and written without anybody asking. What was
 * missing is the other half: the guest on the phone who wants an airport
 * transfer, which is not on any plan and never will be.
 *
 * Until now that took three steps — confirm the booking, find it again,
 * open it, add the line — for something reception was told about while
 * their hands were already on the screen.
 *
 * Pure: what may be added and what it costs, with no screen and no
 * database. Each line is written afterwards through `add_booking_charge`,
 * the same function the booking sheet has always used, so a line added here
 * and a line added later are the same kind of thing.
 */
import { validateCharge } from "./charges";

let seq = 0;

/** A blank line, or one prefilled from the catalogue. */
export function extraRow(item = null) {
  seq += 1;
  return {
    key: `extra-${seq}`,
    charge_item_id: item?.id || "",
    description: item?.name || "",
    quantity: "1",
    unit_amount: item?.default_amount != null ? String(item.default_amount) : "",
  };
}

/**
 * Picking a catalogue item fills the line from it — the description and the
 * standing price — while leaving both editable. The price of a breakfast is
 * the same on every shift; the night reception gives one away is a decision
 * somebody makes on purpose.
 */
export function fillFromItem(row, item) {
  if (!item) return { ...row, charge_item_id: "", description: "", unit_amount: "" };
  return {
    ...row,
    charge_item_id: item.id,
    description: item.name || row.description,
    unit_amount: item.default_amount != null ? String(item.default_amount) : row.unit_amount,
  };
}

/** The same rules the booking sheet applies, so both doors agree. */
export function extrasProblem(rows) {
  for (const row of rows || []) {
    const problem = validateCharge({
      description: row.description, quantity: row.quantity, amount: row.unit_amount,
    });
    if (problem) return problem;
  }
  return null;
}

/** What these lines add to the quote, so the total on screen is the truth. */
export function extrasTotal(rows) {
  return (rows || []).reduce((sum, row) => {
    const quantity = Number(row.quantity);
    const amount = Number(row.unit_amount);
    if (!Number.isFinite(quantity) || !Number.isFinite(amount)) return sum;
    return sum + Math.max(0, quantity) * Math.max(0, amount);
  }, 0);
}

/** One argument set per line, in the order they were typed. */
export function extraPayloads(rows, bookingId) {
  return (rows || []).map((row) => ({
    p_booking: bookingId,
    p_item: row.charge_item_id || null,
    p_description: String(row.description).trim(),
    p_quantity: Number(row.quantity),
    p_amount: Number(row.unit_amount),
  }));
}
