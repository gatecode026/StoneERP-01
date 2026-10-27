'use client';

/**
 * Chatbot Icon matching the website's brand color scheme (stone-brown #8A5C38 and sandstone #D4C2AB).
 * Supports variants:
 * - 'white': Crisp white icon on transparent background (ideal for stone-brown buttons)
 * - 'brand': Stone-brown #8A5C38 icon on transparent background (ideal for light cards, avatar bubbles)
 * - 'badge': Solid stone-brown background with white icon badge
 */
export function ChatbotIcon({ size = 20, variant = 'white', className = '', alt = 'AI Chatbot', ...props }) {
  const src =
    variant === 'brand' || variant === 'color'
      ? '/chatbot-avatar.png'
      : variant === 'badge'
      ? '/chatbot-badge.png'
      : '/chatbot-icon-white.png';

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        flexShrink: 0,
      }}
      {...props}
    />
  );
}

export default ChatbotIcon;
