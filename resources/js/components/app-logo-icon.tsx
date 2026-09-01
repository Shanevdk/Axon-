import type { SVGAttributes } from 'react';

/**
 * The Vanhaven mark: a cube drawn in true isometric, the way an axonometric is set
 * out on the board. Three faces in three weights of the current colour, so it
 * reads on paper white and on the dark chrome of the editor alike.
 */
export default function AppLogoIcon(props: SVGAttributes<SVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            {/* Top face — the plane the light lands on. */}
            <path d="M12 2.5 21 7.75 12 13 3 7.75Z" />
            {/* Right face. */}
            <path d="M21 7.75v8.5L12 21.5V13Z" opacity={0.55} />
            {/* Left face, in shadow. */}
            <path d="M3 7.75v8.5l9 5.25V13Z" opacity={0.28} />
        </svg>
    );
}
