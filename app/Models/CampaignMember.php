<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CampaignMember extends Model
{
    protected $fillable = ['campaign_id', 'user_id', 'role'];
}
