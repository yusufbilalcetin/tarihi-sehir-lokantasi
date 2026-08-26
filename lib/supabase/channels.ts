const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function channelSegment(value: string, label: string): string {
  if (!UUID_SEGMENT.test(value)) {
    throw new Error(`${label} has an invalid realtime channel identifier.`);
  }
  return value.toLowerCase();
}

export function restaurantChannelName(restaurantId: string): string {
  return `restaurant:${channelSegment(restaurantId, "Restaurant")}`;
}

export function restaurantStaffChannelName(restaurantId: string): string {
  return `${restaurantChannelName(restaurantId)}:staff`;
}

export function orderChannelName(restaurantId: string, orderId: string): string {
  return `${restaurantChannelName(restaurantId)}:order:${channelSegment(orderId, "Order")}`;
}
