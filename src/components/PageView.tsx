interface PageViewProps {
  src: string;
  pageNumber: number;
}

export function PageView({ src, pageNumber }: PageViewProps) {
  return (
    <div className="flex justify-center items-center bg-black">
      <img
        src={src}
        alt={`Page ${pageNumber}`}
        className="max-h-screen object-contain select-none"
        draggable={false}
      />
    </div>
  );
}
