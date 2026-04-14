import type { MeasuringInstrumentGenre } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface MeasuringInstrumentGenreCreateInput {
  name: string;
}

export interface MeasuringInstrumentGenreUpdateInput {
  name?: string;
  imageUrlPrimary?: string | null;
  imageUrlSecondary?: string | null;
}

type ImageSlot = 1 | 2;

export class MeasuringInstrumentGenreService {
  async findAll(): Promise<MeasuringInstrumentGenre[]> {
    return await prisma.measuringInstrumentGenre.findMany({ orderBy: { name: 'asc' } });
  }

  async findById(id: string): Promise<MeasuringInstrumentGenre> {
    const genre = await prisma.measuringInstrumentGenre.findUnique({ where: { id } });
    if (!genre) {
      throw new ApiError(404, '計測機器ジャンルが見つかりません');
    }
    return genre;
  }

  async create(data: MeasuringInstrumentGenreCreateInput): Promise<MeasuringInstrumentGenre> {
    try {
      return await prisma.measuringInstrumentGenre.create({
        data: {
          name: data.name.trim()
        }
      });
    } catch {
      throw new ApiError(409, '同名の計測機器ジャンルが既に存在します');
    }
  }

  async update(id: string, data: MeasuringInstrumentGenreUpdateInput): Promise<MeasuringInstrumentGenre> {
    try {
      return await prisma.measuringInstrumentGenre.update({
        where: { id },
        data
      });
    } catch {
      throw new ApiError(404, '計測機器ジャンルが見つかりません');
    }
  }

  async setImage(id: string, slot: ImageSlot, imageUrl: string): Promise<MeasuringInstrumentGenre> {
    const data =
      slot === 1
        ? { imageUrlPrimary: imageUrl }
        : { imageUrlSecondary: imageUrl };
    return await this.update(id, data);
  }

  async clearImage(id: string, slot: ImageSlot): Promise<MeasuringInstrumentGenre> {
    const data =
      slot === 1
        ? { imageUrlPrimary: null }
        : { imageUrlSecondary: null };
    return await this.update(id, data);
  }

  async delete(id: string): Promise<MeasuringInstrumentGenre> {
    const instruments = await prisma.measuringInstrument.count({ where: { genreId: id } });
    if (instruments > 0) {
      throw new ApiError(409, '計測機器に割り当て中のジャンルは削除できません');
    }
    try {
      return await prisma.measuringInstrumentGenre.delete({ where: { id } });
    } catch {
      throw new ApiError(404, '計測機器ジャンルが見つかりません');
    }
  }
}
