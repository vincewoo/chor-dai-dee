import { motion } from 'framer-motion';

const CardCountIndicator = ({ cardCount, className = '' }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className={`relative ${className}`}
            style={{
                width: '50px',
                height: '70px',
            }}
        >
            {/* Card back with red diamond pattern */}
            <div
                className="absolute inset-0 rounded-xl border-2 border-white shadow-md flex items-center justify-center"
                style={{
                    background: `
                        repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                        repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                        linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
                    `,
                }}
            >
                {/* Inner white border frame */}
                <div
                    className="absolute inset-1 border border-white rounded-lg"
                    style={{
                        borderWidth: '1px',
                    }}
                />

                {/* Card count number */}
                <div
                    className="relative z-10 text-white font-bold text-3xl"
                    style={{
                        textShadow: '1px 1px 2px rgba(0,0,0,0.5), -1px -1px 2px rgba(0,0,0,0.3)',
                    }}
                >
                    {cardCount}
                </div>
            </div>
        </motion.div>
    );
};

export default CardCountIndicator;
