import { motion } from 'framer-motion';

const VoiceIndicator = ({ isActive, level = 0 }) => {
  // Removed verbose logging for cleaner console
  if (!isActive) return null;

  // Calculate pulse scale based on audio level (0-1)
  const scale = 1 + (level * 0.5);

  return (
    <motion.div
      className="absolute -top-2 -right-2 z-50"
      initial={{ scale: 1 }}
      animate={{ scale: 1 }}
      exit={{ scale: 0 }}
    >
      {/* Outer pulsing ring */}
      <motion.div
        className="absolute inset-0 bg-green-400 rounded-full opacity-30"
        animate={{
          scale: level > 0.05 ? [1, scale, 1] : 1,
        }}
        transition={{
          duration: 0.3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        style={{
          width: '24px',
          height: '24px',
        }}
      />

      {/* Inner solid circle */}
      <div className="relative w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
        <svg
          className="w-3 h-3 text-white"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      {/* Audio level bars */}
      <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 flex gap-0.5">
        {[0.2, 0.4, 0.6].map((threshold, index) => (
          <motion.div
            key={index}
            className={`w-1 bg-green-400 rounded-full ${
              level > threshold ? 'opacity-100' : 'opacity-30'
            }`}
            animate={{
              height: level > threshold ? '8px' : '4px',
            }}
            transition={{ duration: 0.1 }}
          />
        ))}
      </div>
    </motion.div>
  );
};

export default VoiceIndicator;