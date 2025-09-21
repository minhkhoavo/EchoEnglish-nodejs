import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  end: number;
}

class YoutubeTranscriptService {
  public extractVideoId = (url: string): string | null => {
    if (!url) return null;

    // Regex này match được nhiều dạng link youtube khác nhau
    const regex =
      /(?:youtube\.com\/(?:.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

    const match = url.match(regex);
    return match ? match[1] : null;
  };

  public fetchTranscript = async (
    url: string
  ): Promise<TranscriptSegment[]> => {
    if (!url) throw new ApiError(ErrorMessage.YOUTUBE_URL_REQUIRE);

    const vid = this.extractVideoId(url);
    if (!vid) throw new ApiError(ErrorMessage.INVALID_URL_ID_YOUTUBE);

    console.log('>>> Extracted videoId:', vid);

    const transcriptItems = await YoutubeTranscript.fetchTranscript(vid, {
      lang: 'en',
    });

    console.log('>>> Raw transcriptItems:', transcriptItems);

    return transcriptItems.map((r) => ({
      text: r.text,
      start: r.offset,
      duration: r.duration,
      end: r.duration + r.offset,
    }));
  };
}

export default new YoutubeTranscriptService();
