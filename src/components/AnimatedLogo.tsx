export function AnimatedLogo({ className = '' }: { className?: string }) {
  return (
    <svg 
      className={`animate-logo-glow ${className}`} 
      viewBox="0 0 600 600" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g className="animate-logo-spin" style={{ transformOrigin: '300px 300px' }}>
        {/* LEFT HALF: 4 Solid Cyan Concentric Semi-Circular Rings */}
        <path d="M 300,185 A 115,115 0 0,0 300,415 L 300,385 A 85,85 0 0,1 300,215 Z" fill="#1ecbde" />
        <path d="M 300,145 A 155,155 0 0,0 300,455 L 300,425 A 125,125 0 0,1 300,175 Z" fill="#1ecbde" />
        <path d="M 300,105 A 195,195 0 0,0 300,495 L 300,465 A 165,165 0 0,1 300,135 Z" fill="#1ecbde" />
        <path d="M 300,65 A 235,235 0 0,0 300,535 L 300,505 A 205,205 0 0,1 300,95 Z" fill="#1ecbde" />

        {/* RIGHT HALF: 4 Matching White Outline Semi-Circular Rings */}
        <path d="M 300,185 A 115,115 0 0,1 300,415 L 300,385 A 85,85 0 0,0 300,215 Z" stroke="#ffffff" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
        <path d="M 300,145 A 155,155 0 0,1 300,455 L 300,425 A 125,125 0 0,0 300,175 Z" stroke="#ffffff" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
        <path d="M 300,105 A 195,195 0 0,1 300,495 L 300,465 A 165,165 0 0,0 300,135 Z" stroke="#ffffff" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
        <path d="M 300,65 A 235,235 0 0,1 300,535 L 300,505 A 205,205 0 0,0 300,95 Z" stroke="#ffffff" strokeWidth="2.5" fill="none" strokeLinejoin="round" />

        {/* Center Axis Guideline Divider */}
        <line x1="300" y1="55" x2="300" y2="545" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4 4" />
      </g>
    </svg>
  );
}