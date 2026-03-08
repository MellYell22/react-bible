export const createCheckoutSession = async (priceId: string, userId: string) => {
  const response = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId, userId }),
  });
  
  const data = await response.json();
  if (data.url) {
    window.location.href = data.url;
  } else {
    throw new Error(data.error || 'Failed to create checkout session');
  }
};
