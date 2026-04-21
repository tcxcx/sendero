import * as React from 'react';

type StaticImageDataLike = {
  src: string;
  width?: number;
  height?: number;
};

type StorybookImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | StaticImageDataLike;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: 'blur' | 'empty' | `data:image/${string}`;
  blurDataURL?: string;
  loader?: unknown;
  unoptimized?: boolean;
};

const Image = React.forwardRef<HTMLImageElement, StorybookImageProps>(
  (
    {
      src,
      fill,
      priority: _priority,
      quality: _quality,
      placeholder: _placeholder,
      blurDataURL: _blurDataURL,
      loader: _loader,
      unoptimized: _unoptimized,
      style,
      width,
      height,
      ...props
    },
    ref
  ) => {
    const resolvedSrc = typeof src === 'string' ? src : src.src;
    const resolvedWidth = width ?? (typeof src === 'string' ? undefined : src.width);
    const resolvedHeight = height ?? (typeof src === 'string' ? undefined : src.height);

    return (
      <img
        ref={ref}
        src={resolvedSrc}
        width={fill ? undefined : resolvedWidth}
        height={fill ? undefined : resolvedHeight}
        style={{
          ...(fill
            ? {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: props.loading === 'lazy' ? undefined : 'cover',
              }
            : null),
          ...style,
        }}
        {...props}
      />
    );
  }
);

Image.displayName = 'StorybookNextImage';

export default Image;
