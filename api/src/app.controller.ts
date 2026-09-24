import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getStatus() {
    return this.appService.getStatus();
  }

  @Get('uploads')
  listUploads() {
    return this.appService.listUploads();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File) {
    return { filename: file.filename, size: file.size };
  }

  @Post('mail')
  sendMail(@Body('to') to: string) {
    return this.appService.sendMail(to ?? 'dev@example.com');
  }
}
